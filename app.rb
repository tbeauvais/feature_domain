require 'sinatra/base'
require 'sinatra/contrib'
require 'sinatra/assetpack'
require 'slim'
require 'coffee-script'

class App < Sinatra::Base

  set :environment, :development
  set :root, File.dirname(__FILE__) # You must set app root

  helpers Sinatra::JSON
  register Sinatra::AssetPack

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

end
