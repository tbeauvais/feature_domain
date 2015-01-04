require 'sinatra/base'
require 'sinatra/contrib'
require 'sinatra/assetpack'
require 'sinatra/namespace'
require 'slim'
require 'coffee-script'
require 'model_access'


class App < Sinatra::Base

  set :environment, :development
  set :root, File.dirname(__FILE__) # You must set app root

  access = ModelAccess.new

  helpers Sinatra::JSON
  register Sinatra::AssetPack
  register Sinatra::Namespace

  assets do

    js_compression  :uglify, mangle: false

    serve '/js',     from: 'app/js'
    serve '/css',    from: 'app/css'
    serve '/images', from: 'app/images'

    js :app, %w(
      /js/vendor/jquery-2.1.1.js
      /js/vendor/jquery-ui.js
      /js/vendor/bootstrap.js
      /js/vendor/angular.js
      /js/vendor/angular-resource.js
      /js/vendor/sortable.js
      /js/vendor/underscore.js
      /js/vendor/tree-model.js
      /js/vendor/d3.js
      /js/vendor/draganddrop.js
      /js/application.js
      /js/*.js
    )

    css :app, %w(
      /css/*.css
      /css/vendor/*.css
    )

  end

  get '/' do
    slim :index
  end

  get '/content' do
    slim :content, layout: false
  end

  get '/api/app_features' do
    content_type :json
    File.open('sample.json', 'rb') { |file| file.read }
  end

  post '/api/app_features' do
    content_type :json
    File.open('sample.json', 'w') {|f| f.write(request.body.read) }
    json success: 'OK'
  end

  namespace '/api/v1' do

    get '/models' do
      content_type :json
      model_names = access.model_names
      if model_names.empty?
        features = File.open('sample.json', 'rb') { |file| file.read }
        access.add_model({name: 'sample', features: JSON.parse(features)})
        model_names = access.model_names
      end
      model_names.to_json
    end

    get '/models/:id' do
      content_type :json
      model = access.fetch_model(params[:id])
      unless model
        status 410
        body ''
      else
        model.to_json
      end
    end

    post '/models' do
      content_type :json
      status 201
      model = request.body.read
      model = JSON.parse(model)
      access.add_model(model).to_json
    end

    delete '/models/:id' do
      content_type :json
      status 204
      access.delete_model(params[:id])
      body ''
    end

    put '/models/:id' do
      content_type :json
      model = request.body.read
      model = JSON.parse(model)
      access.update_model(params[:id], model).to_json
    end

  end

end
