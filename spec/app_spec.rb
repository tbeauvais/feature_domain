require 'spec_helper'

describe 'Content Domain App' do

  it 'has default route' do
    get '/'
    expect(last_response).to be_ok
  end

  context 'model' do

    let(:access) { ModelAccess.new }
    let(:model) { {'name' => 'sample', 'features' => [{'id' => '1'}]} }
    let(:new_model) { access.add_model(model) }

    it 'get list of all models' do
      new_model
      get '/api/v1/models'
      expect(last_response.body).to eq '[{"id":"384fb29b-c53f-4d71-8498-a35e8a7321a4","name":"sample"}]'
    end

    context 'post' do

      it 'adds new model' do
        post '/api/v1/models', model.to_json
        expect(last_response.body).to eq model.merge('id' => '384fb29b-c53f-4d71-8498-a35e8a7321a4').to_json
      end

      it 'responds with 201' do
        post '/api/v1/models', model.to_json
        expect(last_response.status).to eq 201
      end

    end

    context 'get' do

      it 'returns the specific model' do
        new_model
        get '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        expect(last_response.body).to eq new_model.to_json
      end

      it 'results in 410 if not found' do
        get '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        expect(last_response.status).to eq 410
      end

    end

    context 'put' do

      it 'updates an existing model' do
        new_model
        put '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4', model.merge('name' => 'changed').to_json
        expect(last_response).to be_ok
        get '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        expect(last_response.body).to eq model.merge('name' => 'changed').to_json
      end

      it 'responds with 200' do
        new_model
        put '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4', model.merge('name' => 'changed').to_json
        expect(last_response.status).to eq 200
      end

    end

    context 'delete' do

      let!(:new_model) { access.add_model(model) }

      it 'responds with 204' do
        delete '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        expect(last_response.status).to eq 204
      end

      it 'removes model' do
        delete '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        get '/api/v1/models/384fb29b-c53f-4d71-8498-a35e8a7321a4'
        expect(last_response.status).to eq 410
      end

    end
  end

end
