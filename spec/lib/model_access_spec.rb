require 'spec_helper'

describe ModelAccess do

  let(:access) { ModelAccess.new }
  let(:model) { {'name' => 'sample', 'features' => {}} }
  let(:new_model) { access.add_model(model) }
  let(:uuid) { '384fb29b-c53f-4d71-8498-a35e8a7321a4' }
  let(:saved_model) {{'id' => uuid, 'name' => 'sample', 'features' => {}}}

  it '#fetch_models returns all models' do
    new_model
    expect(access.fetch_models).to eq [saved_model]
  end

  it '#model_names returns all model names/ids' do
    new_model
    expect(access.model_names).to eq [{'id' => uuid, 'name' => 'sample'}]
  end

  it '#fetch_models empty array if no models' do
    expect(access.fetch_models).to eq []
  end

  it '#fetch_model returns specified model' do
    expect(access.fetch_model(new_model['id'])).to eq saved_model
  end

  it '#fetch_model returns null if model does not exist' do
    expect(access.fetch_model(SecureRandom.uuid)).to be_nil
  end

  it '#delete_model removes the specified model' do
    new_model
    expect{access.delete_model(uuid)}.to change{access.fetch_models.size}.from(1).to(0)
  end

  it '#update_model changes the specified model' do
    new_model[:name] = 'changed'
    access.update_model(uuid, new_model)
    expect(access.fetch_model(uuid)).to eq ({'id' => uuid, 'name' => 'changed', 'features' => {}})
  end

  it '#add_model adds a new model' do
    expect{access.add_model({name: 'sample', features: {}})}.to change{access.fetch_models.size}.from(0).to(1)
  end

  it '#add_model returns the new model' do
    expect(access.add_model(model)).to eq saved_model
  end

end